import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { View, FlatList } from 'react-native';
import { Title } from 'react-native-paper';
import styles from '../assets/styles/blink/_ConferenceAudioParticipant.scss';


const ConferenceAudioParticipantList = props => {
    return (
        <Fragment>
            <Title style={styles.title}>Participants</Title>
            <FlatList
                data={props.children}
                renderItem={({item}) => {return (item)}}
            />
        </Fragment>
    );
};

ConferenceAudioParticipantList.propTypes = {
    children: PropTypes.node
};

export default ConferenceAudioParticipantList;
