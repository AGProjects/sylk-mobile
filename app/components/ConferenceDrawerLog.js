import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Title, Text, List } from 'react-native-paper';
import { View, FlatList } from 'react-native';

import styles from '../assets/styles/blink/_ConferenceDrawerLog.scss';


const ConferenceDrawerLog = props => {
    const renderItem = ( {item, index} ) => {
        const elem = item
        const originator = elem.originator.displayName || elem.originator.uri || elem.originator;

        const messages = elem.messages.map((message, index) => {
            return <Text style={styles.messageText} key={index}>{message}</Text>;
        });

        const number = props.log.length - index;

        const color = utils.generateMaterialColor(elem.originator.uri || elem.originator)['300'];
        const title = (<><Text style={{color: color}}>{originator}</Text> {elem.action} {messages}</>);
        return (
            <List.Item
                style={styles.lessPadding}
                titleNumberOfLines={2}
                title={title}
                key={originator}
                titleStyle={styles.messageText}
                left={props => <View style={styles.leftContainer}><Text style={styles.messageText}>{number}</Text></View>}
            />
        )
    }
    return (
        <Fragment>
            <Title>Configuration events</Title>
            <FlatList
                data={props.log}
                renderItem={renderItem}
                keyExtractor={(item, index) => {`${index}`}}
            >
            </FlatList>
        </Fragment>
    );
};

ConferenceDrawerLog.propTypes = {
    log: PropTypes.array.isRequired
};


export default ConferenceDrawerLog;
