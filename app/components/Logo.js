import React, { Fragment } from 'react';
import { View, Image } from 'react-native';
import { Title } from 'react-native-paper';
import styles from '../assets/styles/blink/_Logo.scss';

const blinkLogo = require('../assets/images/blink-white-big.png');

const Logo = () => {
    return (
        <Fragment>
            <View style={styles.logoContainer}>
                <Image source={blinkLogo} style={styles.logo}/>
            </View>
            <Title style={styles.title}>Sylk</Title>
        </Fragment>
    );
}


export default Logo;
