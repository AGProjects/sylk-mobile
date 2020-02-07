import React, { Fragment } from 'react';
import PropTypes from 'prop-types';
import utils from '../utils';
import { Title } from 'react-native-paper';

const ConferenceDrawerLog = (props) => {
    const entries = props.log.map((elem, idx) => {
        // const classes = classNames({
        //     'text-danger'   : elem.level === 'error',
        //     'text-warning'  : elem.level === 'warning',
        //     'log-entry'     : true
        // });

        const originator = elem.originator.displayName || elem.originator.uri || elem.originator;

        const messages = elem.messages.map((message, index) => {
            return <span key={index}>{message}<br /></span>;
        });

        const color = utils.generateMaterialColor(elem.originator.uri || elem.originator)['300'];
        return null;
        // return (
        //     <View key={idx}>
        //         <View className="idx"><{props.log.length - idx}</View>
        //         <View>
        //             <Text className="label label-info" style={{backgroundColor: color}}>{originator}</span> <span>{elem.action}</span><br />{messages}</Text
        //         </View>
        //     </View>
        // )
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
