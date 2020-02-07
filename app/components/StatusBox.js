import React from 'react';
import { View } from 'react-native';
import PropTypes from 'prop-types';
import { Snackbar } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const StatusBox = (props) => {

    let iconName;
    switch (props.level) {
        case 'info':
            iconName = 'information-outline';
            break;
        case 'danger':
            iconName = 'alert-circle-outline';
            break;
        case 'warning':
            iconName = 'alert-octogon-outline';
            break;
    }

    return (
        <Snackbar visible={true} duraction={2000} onDismiss={() => {}}>
            { iconName ? (<Icon name={iconName} />) : null }{ props.title }{ props.message }
        </Snackbar>
    );
};

StatusBox.propTypes = {
    level: PropTypes.string,
    message: PropTypes.string.isRequired,
    title: PropTypes.string,
};


export default StatusBox;
