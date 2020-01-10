
import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import { List } from 'react-native-paper';

const ConferenceDrawerParticipantList = (props) => {
    const items = [];
    let idx = 0;
    React.Children.forEach(props.children, (child) => {
        items.push(<List.Item title={child} key={idx} />);
        idx++;
    });

    return (
        <View>
            <List.Section>
                <List.Subheader>Participants</List.Subheader>
                {items}
            </List.Section>
        </View>
    );
};

ConferenceDrawerParticipantList.propTypes = {
    children: PropTypes.node
};

export default ConferenceDrawerParticipantList;
