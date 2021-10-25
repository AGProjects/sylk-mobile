import React from 'react';
import PropTypes from 'prop-types';

import UserIcon from './UserIcon';
import { List, Text } from 'react-native-paper';

const ConferenceDrawerParticipant = (props) => {
    let tag = null
    if (props.isLocal) {
        tag = 'Myself';
    }

    let participant = props.participant;

    if (!participant) {
        return null;
    }

    return (
        <List.Item
            title={participant.identity.displayName || participant.identity.uri}
            left={props => <UserIcon identity={participant.identity} />}
            key={participant.identity.uri}
            right={props => tag ? <Text>{tag}</Text> : null}
        />
    )


}

ConferenceDrawerParticipant.propTypes = {
    participant: PropTypes.object.isRequired,
    isLocal: PropTypes.bool
};


export default ConferenceDrawerParticipant;
