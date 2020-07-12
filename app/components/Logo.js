import React, { Fragment } from 'react';
import { View, Image, Text} from 'react-native';
import { Title } from 'react-native-paper';
import PropTypes from 'prop-types';
import styles from '../assets/styles/blink/_Logo.scss';

const blinkLogo = require('../assets/images/blink-white-big.png');

const Logo = (props) => {
    let containerClass;

    if (props.isTablet) {
        containerClass = props.orientation === 'landscape' ? styles.landscapeTabletContainer : styles.portraitTabletContainer;
    } else {
        containerClass = props.orientation === 'landscape' ? styles.landscapeContainer : styles.portraitContainer;
    }

    return (
            <View style={containerClass}>
                <Image source={blinkLogo} style={styles.logo}/>
                <Text style={styles.text}>&copy; AG Projects</Text>
            </View>
    );
}

Logo.propTypes = {
    orientation            : PropTypes.string,
    isTablet               : PropTypes.bool
};

export default Logo;
