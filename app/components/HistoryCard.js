import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Card, IconButton, Headline, Subheading } from 'react-native-paper';
import { Icon } from 'react-native-vector-icons';

import UserIcon from './UserIcon';

const HistoryCard = (props) => {
    const classes = props.classes;
    const identity = {
        displayName: props.historyItem.displayName,
        uri: props.historyItem.remoteParty || props.historyItem
    }

    const startVideoCall = (e) => {
        e.stopPropagation();
        props.setTargetUri(identity.uri);
        // We need to wait for targetURI
        setImmediate(() => {
            props.startVideoCall(e);
        });
    }

    const startAudioCall = (e) => {
        e.stopPropagation();
        props.setTargetUri(identity.uri);
        // We need to wait for targetURI
        setImmediate(() => {
            props.startAudioCall(e);
        });
    }

    let duration = moment.duration(props.historyItem.duration, 'seconds').format('hh:mm:ss', {trim: false});
    let color = {};
    if (props.historyItem.direction === 'received' && props.historyItem.duration === 0) {
        color.color = '#a94442';
        duration = 'missed';
    }

    const name = identity.displayName || identity.uri;

    return (
        <Card
            onLongPress={() => {props.setTargetUri(identity.uri)}}
            onPress={startVideoCall}
        >
            <Card.Content>
                <Headline noWrap style={color}>{name} ({duration})</Headline>
                <Subheading color="textSecondary">
                    <Icon name={props.historyItem.direction == 'received' ? 'arrow-bottom-left' : 'arrow-top-right'}/>{props.historyItem.startTime}
                </Subheading>
            </Card.Content>
            <Card.Actions>
                <IconButton icon="phone" className={classes.iconSmall} onPress={startAudioCall} title={`Audio call to ${name}`} />
                <IconButton icon="video" className={classes.iconSmall} onPress={startVideoCall} title={`Video call to ${name}`} />
            </Card.Actions>
            <View>
                <UserIcon identity={identity} card/>
            </View>
        </Card>
    );
}

HistoryCard.propTypes = {
    classes        : PropTypes.object.isRequired,
    historyItem    : PropTypes.object,
    startAudioCall : PropTypes.func.isRequired,
    startVideoCall : PropTypes.func.isRequired,
    setTargetUri   : PropTypes.func.isRequired
};


export default HistoryCard;
