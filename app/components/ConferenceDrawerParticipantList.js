// SPDX-FileCopyrightText: 2020, AG Projects
// SPDX-License-Identifier: GPL-3.0-only

import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { FlatList } from 'react-native';
import { Title } from 'react-native-paper';


const ConferenceDrawerParticipantList = props => {
    return (
        <Fragment>
            <Title>Participants</Title>
            <FlatList
                data={props.children}
                renderItem={({item}) => {return (item)}}
            />
        </Fragment>
    );
};

ConferenceDrawerParticipantList.propTypes = {
    children: PropTypes.node
};

export default ConferenceDrawerParticipantList;
