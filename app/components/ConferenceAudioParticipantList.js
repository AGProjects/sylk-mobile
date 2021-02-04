// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { View, FlatList } from 'react-native';
import { Title } from 'react-native-paper';
import styles from '../assets/styles/blink/_ConferenceAudioParticipant.scss';


const ConferenceAudioParticipantList = props => {
//  <Title style={styles.title}>Participants</Title>

    return (
        <Fragment>
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
