
import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import { List, Title } from 'react-native-paper';

const ConferenceDrawerParticipantList = (props) => {
    return (
        <Fragment>
            <Title>Participants</Title>
            <List.Section>
                {props.children}
            </List.Section>
        </Fragment>
    );
};

ConferenceDrawerParticipantList.propTypes = {
    children: PropTypes.node
};

export default ConferenceDrawerParticipantList;
