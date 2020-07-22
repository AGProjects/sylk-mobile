import React, { Component} from 'react';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Button, Caption, Title, Subheading } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';

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

class HistoryCard extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            id: this.props.contact.id,
            displayName: this.props.contact.displayName,
            uri: this.props.contact.remoteParty,
            participants: this.props.contact.participants,
            conference: this.props.contact.conference,
            type: this.props.contact.type,
            photo: this.props.contact.photo,
            label: this.props.contact.label,
            orientation: this.props.orientation,
            isTablet: this.props.isTablet,
            favorite: (this.props.contact.tags.indexOf('favorite') > -1)? true : false,
            blocked: (this.props.contact.tags.indexOf('blocked') > -1)? true : false
        }
    }

    shouldComponentUpdate(nextProps) {
        //https://medium.com/sanjagh/how-to-optimize-your-react-native-flatlist-946490c8c49b
        return true;
    }

    setBlockedUri() {
        let newBlockedState = this.props.setBlockedUri(this.state.uri);
        this.setState({blocked: newBlockedState});
    }

    setFavoriteUri() {
        let newFavoriteState = this.props.setFavoriteUri(this.state.uri);
        this.setState({favorite: newFavoriteState});
    }

    setTargetUri(uri, contact) {
        this.props.setTargetUri(this.state.uri, this.props.contact);
    }

    render () {
        let containerClass = styles.portraitContainer;
        let cardClass = styles.card;
        //console.log('Render card', this.state.uri, this.state.orientation);

        let showActions = this.props.contact.showActions && this.props.contact.tags.indexOf('test') === -1;

        let buttonMode = 'text';
        let showBlockButton = true;
        let showFavoriteButton = true;
        let blockTextbutton = 'Block';
        let favoriteTextbutton = 'Add favorite';

        if (this.state.favorite) {
            favoriteTextbutton = 'Remove favorite';
            if (!this.state.blocked) {
                showBlockButton = false;
            }
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

        let title = this.state.displayName || this.state.uri.split('@')[0];
        let subtitle = this.state.uri;
        let description = this.props.contact.startTime;

        if (this.state.displayName === this.state.uri) {
            title = toTitleCase(this.state.uri.split('@')[0]);
        }

        if (this.state.type === 'history') {
            let duration = moment.duration(this.props.contact.duration, 'seconds').format('hh:mm:ss', {trim: false});

            if (this.props.contact.direction === 'received' && this.props.contact.duration === 0) {
                color.color = '#a94442';
                duration = 'missed';
            } else if (this.props.contact.direction === 'placed' && this.props.contact.duration === 0) {
                duration = 'cancelled';
            }

            if (this.state.conference) {
                if (this.state.participants && this.state.participants.length) {
                    subtitle = 'With: ';
                    let i = 0;
                    this.state.participants.forEach((participant) => {
                        if (i > 0) {
                            subtitle = subtitle + ', ' + participant.split('@')[0];
                        } else {
                            subtitle = subtitle + participant.split('@')[0];
                        }
                    });
                } else {
                    subtitle = 'No participants';
                }
            }

            if (!this.state.displayName) {
                title = this.state.uri;
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
                <Card
                    onPress={() => {this.setTargetUri(this.state.uri, this.props.contact)}}
                    style={[containerClass, cardClass]}
                    >
                    <Card.Content style={styles.content}>
                        <View style={styles.mainContent}>
                            <Title noWrap style={color}>{title}</Title>
                            <Subheading noWrap style={color}>{subtitle}</Subheading>
                            <Caption color="textSecondary">
                                <Icon name={this.props.contact.direction == 'received' ? 'arrow-bottom-left' : 'arrow-top-right'}/>{description}
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
                        </Card.Actions>
                        </View>
                        : null}
                </Card>
            );

        } else {

            return (
                <Card
                    onPress={() => {this.props.setTargetUri(this.state.uri, this.props.contact)}}
                    style={[containerClass, cardClass]}
                >
                    <Card.Content style={styles.content}>
                        <View style={styles.mainContent}>
                            <Title noWrap style={color}>{title}</Title>
                            <Subheading noWrap style={color}>{this.state.uri}</Subheading>
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
    orientation    : PropTypes.string,
    isTablet       : PropTypes.bool
};


export default HistoryCard;
