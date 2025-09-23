import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Snackbar } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'; // adjust import if needed
import PropTypes from 'prop-types';
//import styles from '../assets/styles/blink/_StatusBox.scss';

const StatusBox = (props) => {
    const [visible, setVisible] = useState(true);

    // Choose an icon based on the level
    let iconName;
    switch (props.level) {
        case 'info':
            iconName = 'information-outline';
            break;
        case 'danger':
            iconName = 'alert-circle-outline';
            break;
        case 'warning':
            iconName = 'alert-octagon-outline';
            break;
        default:
            iconName = null;
    }

    // Combine title and message into one string for Snackbar
    const messageText = props.title ? `${props.title}: ${props.message}` : props.message;

    return (
        <Snackbar
            visible={visible}
            duration={5000}
            onDismiss={() => setVisible(false)}
            style={styles.snackbar}
            action={{
                label: iconName ? <Icon name={iconName} size={20} color="#fff" /> : '',
                onPress: () => {},
            }}
        >
            <Text style={styles.text}>{messageText}</Text>
        </Snackbar>
    );
};

StatusBox.propTypes = {
    level: PropTypes.string,
    message: PropTypes.string.isRequired,
    title: PropTypes.string,
};

const styles = StyleSheet.create({
    snackbar: {
        backgroundColor: '#333', // dark background
        borderRadius: 8,
        margin: 8,
    },
    text: {
        color: '#fff',
        fontSize: 14,
    },
});

export default StatusBox;


