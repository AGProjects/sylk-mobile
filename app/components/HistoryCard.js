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

        this.identity = {
            displayName: this.props.contact.displayName || this.props.contact.name,
            uri: this.props.contact.remoteParty || this.props.contact.uri,
            type: this.props.contact.type || 'contact',
            photo: this.props.contact.photo,
            label: this.props.contact.label
        }

        //console.log(this.props.contact);
   }

    startVideoCall(e) {
        e.stopPropagation();
        this.props.setTargetUri(this.identity.uri);
        // We need to wait for targetURI
        setImmediate(() => {
            this.props.startVideoCall(e);
        });
    }

    startAudioCall(e) {
        e.stopPropagation();
        this.props.setTargetUri(this.identity.uri);
        // We need to wait for targetURI
        setImmediate(() => {
            this.props.startAudioCall(e);
        });
    }

    render () {
        //console.log('Render card', this.identity.uri);

        let containerClass = styles.portraitContainer;

        if (this.props.isTablet) {
            containerClass = (this.props.orientation === 'landscape') ? styles.landscapeTabletContainer : styles.portraitTabletContainer;
        } else {
            containerClass = (this.props.orientation === 'landscape') ? styles.landscapeContainer : styles.portraitContainer;
        }

        let color = {};
        const name = this.identity.displayName || this.identity.uri;
        let title = this.identity.displayName || this.identity.uri;
        let subtitle = this.identity.uri;

        let description = this.props.contact.startTime;

        if (this.identity.type === 'history') {
            let duration = moment.duration(this.props.contact.duration, 'seconds').format('hh:mm:ss', {trim: false});

            if (this.props.contact.direction === 'received' && this.props.contact.duration === 0) {
                color.color = '#a94442';
                duration = 'missed';
            } else if (this.props.contact.direction === 'placed' && this.props.contact.duration === 0) {
                duration = 'cancelled';
            }

            if (duration) {
                let subtitle = this.identity.uri + ' (' + duration + ')';
            }

            if (!this.identity.displayName) {
                title = this.identity.uri;
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
                    onPress={() => {this.props.setTargetUri(this.identity.uri, this.props.contact)}}
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
                            <UserIcon style={styles.userIcon} identity={this.identity} card/>
                        </View>
                    </Card.Content>
                </Card>
            );

        } else {
            return (
                <Card
                    onPress={() => {this.props.setTargetUri(this.identity.uri, this.props.contact)}}
                    onLongPress={this.startVideoCall}
                    style={containerClass}
                >
                    <Card.Content style={styles.content}>
                        <View style={styles.mainContent}>
                            <Title noWrap style={color}>{title}</Title>
                            <Subheading noWrap style={color}>{this.identity.uri}</Subheading>
                            <Caption color="textSecondary">
                                {this.identity.label}
                            </Caption>
                        </View>
                        <View style={styles.userAvatarContent}>
                            <UserIcon style={styles.userIcon} identity={this.identity} card/>
                        </View>
                    </Card.Content>
                </Card>
            );
        }
    }

/*
            <Card.Actions>
                <IconButton icon="phone" onPress={startAudioCall} title={`Audio call to ${name}`} />
                <IconButton icon="video" onPress={startVideoCall} title={`Video call to ${name}`} />
            </Card.Actions>
*/


}

HistoryCard.propTypes = {
    contact    : PropTypes.object,
    startAudioCall : PropTypes.func,
    startVideoCall : PropTypes.func,
    setTargetUri   : PropTypes.func,
    orientation    : PropTypes.string,
    isTablet       : PropTypes.bool
};


export default HistoryCard;
