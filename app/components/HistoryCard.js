import React, { Component} from 'react';
import { View } from 'react-native';
import autoBind from 'auto-bind';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Caption, Title, Subheading } from 'react-native-paper';
import Icon from  'react-native-vector-icons/MaterialCommunityIcons';

import styles from '../assets/styles/blink/_HistoryCard.scss';

import UserIcon from './UserIcon';


class HistoryCard extends Component {
    constructor(props) {
        super(props);
        autoBind(this);

        this.state = {
            displayName: this.props.contact.displayName,
            uri: this.props.contact.remoteParty,
            participants: this.props.contact.participants,
            conference: this.props.contact.conference,
            type: this.props.contact.type,
            photo: this.props.contact.photo,
            label: this.props.contact.label,
            orientation: this.props.orientation,
            isTablet: this.props.isTablet
        }
    }

    render () {
        let containerClass = styles.portraitContainer;

        if (this.state.isTablet) {
            containerClass = (this.state.orientation === 'landscape') ? styles.landscapeTabletContainer : styles.portraitTabletContainer;
        } else {
            containerClass = (this.state.orientation === 'landscape') ? styles.landscapeContainer : styles.portraitContainer;
        }

        let color = {};
        const name = this.state.displayName || this.state.uri;
        let title = this.state.displayName || this.state.uri;
        let subtitle = this.state.uri;
        let description = this.props.contact.startTime;

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
                    onPress={() => {this.props.setTargetUri(this.state.uri, this.props.contact)}}
                    style={containerClass}
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
                </Card>
            );

        } else {

            return (
                <Card
                    onPress={() => {this.props.setTargetUri(this.state.uri, this.props.contact)}}
                    style={containerClass}
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
                </Card>
            );
        }
    }

}

HistoryCard.propTypes = {
    contact        : PropTypes.object,
    setTargetUri   : PropTypes.func,
    orientation    : PropTypes.string,
    isTablet       : PropTypes.bool
};


export default HistoryCard;
