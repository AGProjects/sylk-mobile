import React, { useState, useEffect, useRef, Fragment } from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import moment from 'moment';
import momentFormat from 'moment-duration-format';
import { Text, Appbar } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import styles from '../assets/styles/blink/_ConferenceHeader.scss';

const useInterval = (callback, delay) => {
    const savedCallback = useRef();

    // Remember the latest callback.
    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    // Set up the interval.
    useEffect(() => {
        function tick() {
            savedCallback.current();
        }
        if (delay !== null) {
            let id = setInterval(tick, delay);
            return () => clearInterval(id);
        }
    }, [delay]);
}

const ConferenceHeader = (props) => {
    let [seconds, setSeconds] = useState(0);

    useInterval(() => {
        setSeconds(seconds + 1);
    }, 1000);

    const duration = moment.duration(seconds, 'seconds').format('hh:mm:ss', {trim: false});

    let videoHeader;
    let callButtons;

    if (props.show) {
        const participantCount = props.participants.length + 1;
        // const callDetail = (
        //     <View>
        //         <Icon name="clock-outline" />{duration} - <Icon name="account-group" />{participantCount} participant{participantCount > 1 ? 's' : ''}
        //     </View>
        // );

        const room = props.remoteUri.split('@')[0];
        let callDetail;

        if (props.reconnectingCall) {
            callDetail = 'Reconnecting call...';
        } else {
            callDetail = `Duration: ${duration} - ${participantCount} participant${participantCount > 1 ? 's' : ''}`;
        }

        videoHeader = (
            <Appbar.Header style={{backgroundColor: 'rgba(34,34,34,.7)'}}>
                <Appbar.Content
                    title={`Conference: ${room}`}
                    subtitle={callDetail}
                />
                {props.buttons.top.right}
            </Appbar.Header>
        );

        callButtons = (
            <View style={styles.buttonContainer}>
                {props.buttons.bottom}
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {videoHeader}
            {callButtons}
        </View>
    );
}

ConferenceHeader.propTypes = {
    show: PropTypes.bool.isRequired,
    remoteUri: PropTypes.string.isRequired,
    participants: PropTypes.array.isRequired,
    buttons: PropTypes.object.isRequired,
    reconnectingCall: PropTypes.bool
};


export default ConferenceHeader;
