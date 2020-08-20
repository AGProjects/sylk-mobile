import React, { Component, Fragment} from 'react';
import { View, SafeAreaView, FlatList } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Button, Caption, Title, Subheading, List, Text} from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';
import uuid from 'react-native-uuid';
import EditConferenceModal from './EditConferenceModal';

import styles from '../assets/styles/blink/_HistoryCard.scss';

import UserIcon from './UserIcon';


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



class HistoryCard extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            id: this.props.contact.id,
            contact: this.props.contact,
            displayName: this.props.contact.displayName,
            uri: this.props.contact.remoteParty,
            invitedParties: this.props.invitedParties,
            participants: this.props.contact.participants,
            conference: this.props.contact.conference,
            type: this.props.contact.type,
            photo: this.props.contact.photo,
            label: this.props.contact.label,
            orientation: this.props.orientation,
            isTablet: this.props.isTablet,
            favorite: (this.props.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (this.props.contact.tags.indexOf('blocked') > -1)? true : false,
            confirmed: false,
            showEditConferenceModal: false
        }

    }

    UNSAFE_componentWillReceiveProps(nextProps) {
        this.setState({
            id: nextProps.contact.id,
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
        });
    }

    shouldComponentUpdate(nextProps) {
        //https://medium.com/sanjagh/how-to-optimize-your-react-native-flatlist-946490c8c49b
        return true;
    }

    toggleEditConferenceModal() {
        this.setState({showEditConferenceModal: !this.state.showEditConferenceModal});
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

    editConference() {
         this.toggleEditConferenceModal();
    }

    deleteHistoryEntry() {
        this.props.deleteHistoryEntry(this.state.uri);
    }

    undo() {
        this.setState({confirmed: false, action: null});
    }

    setFavoriteUri() {
        if (this.state.favorite) {
            if (this.state.confirmed) {
                let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
                this.setState({favorite: newFavoriteState, action: null, confirmed: false});
                this.props.setTargetUri(this.state.uri);
            } else {
                this.setState({confirmed: true});
            }
        } else {
            let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
            this.setState({favorite: newFavoriteState});
        }
    }

    setTargetUri(uri, contact) {
        if (this.isAnonymous(this.state.uri)) {
            return;
        }

        this.props.setTargetUri(uri, this.state.contact);
    }

    isAnonymous(uri) {
        if (uri.indexOf('@guest.') > -1 || uri.indexOf('@anonymous.') > -1) {
            return true
        }

        return false;
    }

    render () {

        let containerClass = styles.portraitContainer;
        let cardClass = styles.card;

        let showActions = this.props.contact.showActions && this.props.contact.tags.indexOf('test') === -1;

        let uri =  this.state.uri;
        let username =  uri.split('@')[0];
        let displayName = this.state.displayName;

        let buttonMode = 'text';
        let showBlockButton = uri.indexOf('@videoconference.') === -1 ? true : false;
        let showFavoriteButton = true;
        let showUndoButton = this.state.confirmed ? true : false;
        let showDeleteButton = (this.props.contact.tags.indexOf('local') > -1 && !this.state.favorite ) ? true: false;
        let showEditButton = (uri.indexOf('@videoconference.') > -1 && this.state.favorite && !this.state.confirmed ) ? true: false;
        let blockTextbutton = 'Block';
        let editTextbutton = 'Edit';
        let favoriteTextbutton = 'Favorite';
        let undoTextbutton = 'Abort';
        let deleteTextbutton = 'Delete';
        let participantsData = [];

        if (this.isAnonymous(uri)) {
            uri = 'anonymous@anonymous.invalid';
            displayName = displayName + ' - from the Web';
            let showFavoriteButton = false;
        }

        if (this.state.favorite) {
            favoriteTextbutton = this.state.confirmed ? 'Confirm' : 'Remove favorite';
            if (!this.state.blocked) {
                showBlockButton = false;
            }
        }

        if (uri.indexOf('3333@') > -1) {
            showBlockButton = false;
        }

        if (uri.indexOf('4444@') > -1) {
            showBlockButton = false;
        }

        if (displayName === 'Myself') {
            showBlockButton = false;
        }

        if (this.state.blocked) {
            blockTextbutton = 'Unblock';
            showFavoriteButton = false;
        }

        if (this.state.isTablet) {
            containerClass = (this.state.orientation === 'landscape') ? styles.landscapeTabletContainer : styles.portraitTabletContainer;
        } else {
            containerClass = (this.state.orientation === 'landscape') ? styles.landscapeContainer : styles.portraitContainer;
        }

        if (showActions) {
            cardClass = styles.expandedCard;
        }

        let color = {};

        let title = displayName || username;
        let subtitle = uri;
        let description = this.props.contact.startTime;

        if (displayName === uri) {
            title = toTitleCase(username);
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
                let participants = (this.state.invitedParties && this.state.invitedParties.length > 0) ? this.state.invitedParties: this.state.participants;
                if (participants && participants.length > 0) {
                    console.log('participants.length', participants.length);
                    const p_text = participants.length > 1 ? 'participants' : 'participant';
                    subtitle = 'With ' + participants.length + ' ' + p_text;
                    let i = 1;
                    let contact_obj;
                    let dn;
                    let _item;
                    participants.forEach((participant) => {
                        contact_obj = this.findObjectByKey(this.props.contacts, 'remoteParty', participant);
                        dn = contact_obj ? contact_obj.displayName : participant;
                        _item = {nr: i, id: uuid.v4(), uri: participant, displayName: dn};
                        participantsData.push(_item);
                        i = i + 1;
                    });
                } else {
                    subtitle = 'With no participants';
                }

                let dn;
                if (participantsData.length > 4 || participantsData.length === 0) {
                    title = username.length > 10 ? 'Conference' : 'Conference ' + toTitleCase(username);
                } else if (participantsData.length > 0 || participantsData.length <= 4 ) {
                    let j = 0;
                    title = '';
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

            return (
                <Fragment>

                <Card
                    onPress={() => {this.setTargetUri(uri, this.props.contact)}}
                    style={[containerClass, cardClass]}
                    >
                    <Card.Content style={styles.content}>
                        <View style={styles.mainContent}>
                            <Title noWrap style={color}>{title}</Title>
                            <Subheading noWrap style={color}>{subtitle}</Subheading>
                            <Caption color="textSecondary">
                                <Icon name={this.props.contact.direction == 'received' ? 'arrow-bottom-left' : 'arrow-top-right'}/>{description}
                            </Caption>
                            {participantsData && participantsData.length && showActions ?
                            <SafeAreaView>
                              <FlatList
                                horizontal={false}
                                data={participantsData}
                                renderItem={renderItem}
                                keyExtractor={item => item.id}
                                key={item => item.id}
                              />
                            </SafeAreaView>
                            : null}

                        </View>
                        <View style={styles.userAvatarContent}>
                            <UserIcon style={styles.userIcon} identity={this.state}/>
                        </View>
                    </Card.Content>
                    {showActions ?
                        <View style={styles.buttonContainer}>
                        <Card.Actions>
                           {showEditButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.editConference()}}>{editTextbutton}</Button>: null}
                           {showDeleteButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.deleteHistoryEntry()}}>{deleteTextbutton}</Button>: null}
                           {showBlockButton? <Button mode={buttonMode} style={styles.button} onPress={() => {this.setBlockedUri()}}>{blockTextbutton}</Button>: null}
                           {showFavoriteButton?<Button mode={buttonMode} style={styles.button} onPress={() => {this.setFavoriteUri()}}>{favoriteTextbutton}</Button>: null}
                           {showUndoButton?<Button mode={buttonMode} style={styles.button} onPress={() => {this.undo()}}>{undoTextbutton}</Button>: null}
                        </Card.Actions>
                        </View>
                        : null}
                </Card>
                <EditConferenceModal
                    show={this.state.showEditConferenceModal}
                    room={title}
                    invitedParties={this.state.invitedParties}
                    selectedContact={this.state.contact}
                    saveInvitedParties={this.saveInvitedParties}
                    close={this.toggleEditConferenceModal}
                    defaultDomain={this.props.defaultDomain}
                />
                </Fragment>

            );

        } else {

            return (
                <Card
                    onPress={() => {this.props.setTargetUri(uri, this.props.contact)}}
                    style={[containerClass, cardClass]}
                >
                    <Card.Content style={styles.content}>
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
    setFavoriteUri : PropTypes.func,
    saveInvitedParties : PropTypes.func,
    deleteHistoryEntry : PropTypes.func,
    orientation    : PropTypes.string,
    isTablet       : PropTypes.bool,
    contacts       : PropTypes.array,
    defaultDomain  : PropTypes.string
};


export default HistoryCard;
