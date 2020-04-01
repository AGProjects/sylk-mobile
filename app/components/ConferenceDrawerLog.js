import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Title, Text, List, Avatar } from 'react-native-paper';

const ConferenceDrawerLog = (props) => {
    const entries = props.log.map((elem, idx) => {
        // const classes = classNames({
        //     'text-danger'   : elem.level === 'error',
        //     'text-warning'  : elem.level === 'warning',
        //     'log-entry'     : true
        // });
        console.log(elem)
        const originator = elem.originator.displayName || elem.originator.uri || elem.originator;

        const messages = elem.messages.map((message, index) => {
            return <Text key={index}>{message}</Text>;
        });

        const number = props.log.length - idx;

        const color = utils.generateMaterialColor(elem.originator.uri || elem.originator)['300'];
        return (
            <List.Item
                title={`${originator} ${elem.action}`}
                description={messages}
                left={props => <Avatar.Text label={number} />}
            />
        )
    });

    return (
        <Fragment>
            <Title>Configuration Events</Title>
            {entries}
        </Fragment>
    );
};

ConferenceDrawerLog.propTypes = {
    log: PropTypes.array.isRequired
};


export default ConferenceDrawerLog;
