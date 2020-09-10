import React from 'react';
import PropTypes from 'prop-types';

import { View} from 'react-native';

import UserIcon from './UserIcon';
import { List, Text } from 'react-native-paper';
import styles from '../assets/styles/blink/_ConferenceAudioParticipant.scss';


const ConferenceAudioParticipant = (props) => {
    let tag = null
    if (props.isLocal) {
        tag = 'Myself';
    }

    let identity = props.identity;

    return (
        <List.Item
        style={styles.card}
            title={props.identity.displayName||props.identity.uri}
            titleStyle={styles.displayName}
            description={props.identity.uri}
            descriptionStyle={styles.uri}
            left={props => <View style={styles.userIconContainer}><UserIcon identity={identity} /></View>}
            right={props => <Text style={styles.right}>{tag}</Text>}
        />
    )

}

ConferenceAudioParticipant.propTypes = {
    identity: PropTypes.object.isRequired,
    isLocal: PropTypes.bool
};


export default ConferenceAudioParticipant;
